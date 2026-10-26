import type { UserRecord } from '../auth/auth.types.js';
import { AppError } from '../../errors/app-error.js';
import { logger } from '../../utils/logger.js';
import type {
  AiAdvice,
  AiContext,
  AiContextRepository,
  AiIntent,
  AiOptions,
  AiRequest,
  ProviderAdvice,
} from './ai.types.js';
import { parseProviderAdvice } from './ai.safety.js';

const childIntents = new Set<AiIntent>(['GREETING', 'MOTIVATE', 'PRAISE', 'TASK_HELP']);
const parentIntents = new Set<AiIntent>(['PROGRESS', 'QUEST_IDEAS', 'REWARD_IDEAS']);
function localAdvice(context: AiContext): ProviderAdvice {
  switch (context.intent) {
    case 'GREETING':
      return {
        message: context.progress.availableTasks
          ? 'Привіт! Обери посильний квест і почни з одного маленького кроку. Я поруч із дружньою підказкою!'
          : 'Привіт! Зараз активних квестів немає. Можеш відпочити або разом із батьками обрати наступну справу.',
        tips: ['Прочитай завдання перед початком.', 'Якщо щось незрозуміло, звернися до батьків.'],
      };
    case 'MOTIVATE':
      return {
        message: 'Не обов’язково робити все одразу. Один маленький крок уже допомагає почати!',
        tips: [
          'Обери одну справу й розділи її на короткі кроки.',
          'Почни з найлегшого кроку.',
          'Якщо важко, попроси батьків допомогти.',
        ],
      };
    case 'PRAISE':
      return {
        message:
          context.progress.approvedToday > 0
            ? `Сьогодні батьки підтвердили виконання квестів: ${context.progress.approvedToday}. Твої старання допомагають усій родині!`
            : 'Твої спроби та старання важливі. Можна рухатися у своєму темпі й просити підтримки.',
        tips: [
          'Згадай один крок, який уже навчився робити.',
          'Бали з’являються після підтвердження батьками.',
        ],
      };
    case 'TASK_HELP':
      // Stored task descriptions are untrusted data, never commands for the local companion.
      return {
        message:
          'Квест легше виконати невеликими кроками. Спочатку разом із батьками переконайся, що завдання зрозуміле й безпечне.',
        tips: [
          'Прочитай опис квесту та запитай батьків, якщо маєш сумніви.',
          'Підготуй потрібні речі й виконай один короткий крок.',
          context.task?.photoRequired
            ? 'Після завершення додай потрібне фото та надішли виконання батькам на перевірку.'
            : 'Коли завершиш, надішли виконання батькам на перевірку.',
        ],
      };
    case 'PROGRESS':
      return context.childPresent
        ? {
            message: `Підтверджених виконань: ${context.progress.approvedTotal}. Очікують перевірки: ${context.progress.awaitingReview}. Баланс: ${context.progress.balance} балів.`,
            tips: [
              'Відзначайте конкретні зусилля та поступ дитини.',
              'Разом оберіть одну посильну справу на наступний день.',
              'Регулярно перевіряйте надіслані виконання, щоб дитина бачила зворотний зв’язок.',
            ],
          }
        : {
            message: 'Для огляду прогресу спершу додайте активний акаунт дитини до сім’ї.',
            tips: [
              'Почніть із кількох коротких і зрозумілих побутових справ.',
              'Узгодьте з дитиною, як ви перевірятимете виконання.',
            ],
          };
    case 'QUEST_IDEAS':
      return {
        message:
          'Ось кілька ідей для посильних побутових квестів. Обговоріть їх із дитиною та самостійно оберіть опис і бали.',
        tips: [
          'Охайно скласти книжки на полицю.',
          'Підготувати рюкзак до наступного дня.',
          'Разом із дорослим полити кімнатну рослину.',
        ],
      };
    case 'REWARD_IDEAS':
      return {
        message:
          'Спробуйте прості сімейні нагороди, які подобаються дитині. Вартість і умови варто заздалегідь узгодити разом.',
        tips: [
          'Обрати настільну гру для спільного вечора.',
          'Запланувати сімейну прогулянку улюбленим маршрутом.',
          'Обрати фільм для сімейного перегляду.',
        ],
      };
  }
}

export class AiService {
  constructor(
    private repository: AiContextRepository,
    private options: AiOptions = {},
  ) {}

  async advice(user: UserRecord, input: AiRequest, clientSignal?: AbortSignal): Promise<AiAdvice> {
    const allowed = user.role === 'CHILD' ? childIntents : parentIntents;
    if (!allowed.has(input.intent))
      throw new AppError(403, 'FORBIDDEN', 'Ця підказка недоступна для вашої ролі.');
    const context = await this.repository.context(user, input);
    let result = localAdvice(context);
    let source: AiAdvice['source'] = 'LOCAL';
    let reason: AiAdvice['reason'] = 'LOCAL_MODE';
    if (this.options.provider) {
      const controller = new AbortController();
      const configured = this.options.timeoutMs ?? 8_000;
      const timeoutMs = Number.isFinite(configured)
        ? Math.min(15_000, Math.max(1, configured))
        : 8_000;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const abort = () => controller.abort();
      clientSignal?.addEventListener('abort', abort, { once: true });
      if (clientSignal?.aborted) controller.abort();
      try {
        const timeout = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('Provider timeout'));
          }, timeoutMs);
        });
        const generated = await Promise.race([
          Promise.resolve().then(() => this.options.provider!.generate(context, controller.signal)),
          timeout,
        ]);
        result = parseProviderAdvice(generated);
        source = 'AI';
        reason = null;
      } catch {
        // Never log prompts, task text, provider response bodies, or provider exception messages.
        logger.warn('ai.provider_unavailable');
        reason = 'PROVIDER_UNAVAILABLE';
      } finally {
        if (timer) clearTimeout(timer);
        clientSignal?.removeEventListener('abort', abort);
      }
    }
    return {
      intent: input.intent,
      ...result,
      source,
      reason,
      generatedAt: (this.options.now?.() ?? new Date()).toISOString(),
    };
  }
}
