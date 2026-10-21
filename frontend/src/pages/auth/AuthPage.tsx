import { useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  loginSchema,
  registerSchema,
  type LoginInput,
  type RegisterInput,
} from '@kidquest/validation';
import type { AuthSession } from '@kidquest/types';
import { ArrowRight, Bot, Check, ShieldCheck, Sparkles, Star, WifiOff } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAuth } from '../../app/providers/AuthProvider';
import { api } from '../../services/api';
import { uk } from '../../lib/i18n';
import { Brand } from '../../components/ui/Brand';
import { ThemeButton } from '../../components/ui/ThemeButton';
import { useOnline } from '../../hooks/useOnline';

export default function AuthPage() {
  const registerMode = useLocation().pathname === '/register';
  const { user, establish } = useAuth();
  if (user) return <Navigate to={user.role === 'PARENT' ? '/parent' : '/child'} replace />;
  return (
    <div className="auth-page">
      <header className="auth-header">
        <Link to="/login" aria-label={uk.app}>
          <Brand />
        </Link>
        <ThemeButton />
      </header>
      <main id="main-content" className="auth-main">
        <section className="auth-story" aria-label={uk.tagline}>
          <span className="eyebrow">
            <span className="tiny-star">
              <Sparkles size={15} />
            </span>
            {uk.secure}
          </span>
          <h1>{uk.tagline}</h1>
          <p className="story-lead">{uk.slogan}</p>
          <div className="quest-illustration" aria-hidden="true">
            <span className="orbit orbit-one" />
            <span className="orbit orbit-two" />
            <span className="floating-star">
              <Star size={34} fill="currentColor" />
            </span>
            <div className="robot">
              <div className="robot-antenna" />
              <Bot size={116} strokeWidth={1.4} />
            </div>
            <div className="illustration-badge">
              <span>
                <Check size={18} />
              </span>
              <div>
                <strong>{uk.dailyTasks}</strong>
                <small>{uk.dailyLead}</small>
              </div>
              <Star className="badge-star" size={20} />
            </div>
          </div>
          <p className="story-note">
            <ShieldCheck size={19} />
            {uk.aboutPoints}
          </p>
        </section>
        <motion.section
          className="auth-card"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <span className="section-label">{registerMode ? uk.familyAccount : uk.app}</span>
          <h2>{registerMode ? uk.registerTitle : uk.welcome}</h2>
          <p className="muted">{registerMode ? uk.registerLead : uk.loginLead}</p>
          {registerMode ? <RegisterForm /> : <LoginForm />}
          <p className="auth-switch">
            {registerMode ? uk.haveAccount : uk.noAccount}{' '}
            <Link to={registerMode ? '/login' : '/register'}>
              {registerMode ? uk.login : uk.register}
              <ArrowRight size={15} />
            </Link>
          </p>
        </motion.section>
      </main>
      <footer className="auth-footer">{uk.footer}</footer>
    </div>
  );

  function LoginForm() {
    const online = useOnline();
    const [error, setError] = useState('');
    const {
      register,
      handleSubmit,
      formState: { errors, isSubmitting },
    } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });
    return (
      <form
        onSubmit={handleSubmit(async (data) => {
          setError('');
          try {
            establish(
              await api<AuthSession>('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
            );
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : uk.genericError);
          }
        })}
        noValidate
      >
        <Field label={uk.email} error={errors.email?.message}>
          <input
            autoComplete="username"
            type="email"
            aria-invalid={!!errors.email}
            {...register('email')}
          />
        </Field>
        <Field label={uk.password} error={errors.password?.message}>
          <input
            autoComplete="current-password"
            type="password"
            aria-invalid={!!errors.password}
            {...register('password')}
          />
        </Field>
        {!online && (
          <p className="notice" role="status">
            <WifiOff size={18} />
            {uk.offline}
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary full" disabled={isSubmitting || !online}>
          {isSubmitting ? uk.wait : uk.login}
          <ArrowRight size={19} />
        </button>
      </form>
    );
  }
  function RegisterForm() {
    const [error, setError] = useState('');
    const online = useOnline();
    const {
      register,
      handleSubmit,
      formState: { errors, isSubmitting },
    } = useForm<RegisterInput>({ resolver: zodResolver(registerSchema) });
    return (
      <form
        onSubmit={handleSubmit(async (data) => {
          setError('');
          try {
            establish(
              await api<AuthSession>('/auth/register', {
                method: 'POST',
                body: JSON.stringify(data),
              }),
            );
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : uk.genericError);
          }
        })}
        noValidate
      >
        <div className="form-row">
          <Field label={uk.firstName} error={errors.firstName?.message}>
            <input autoComplete="given-name" {...register('firstName')} />
          </Field>
          <Field label={uk.familyName} error={errors.familyName?.message}>
            <input autoComplete="organization" {...register('familyName')} />
          </Field>
        </div>
        <Field label={uk.email} error={errors.email?.message}>
          <input autoComplete="username" type="email" {...register('email')} />
        </Field>
        <Field label={uk.password} error={errors.password?.message}>
          <input autoComplete="new-password" type="password" {...register('password')} />
          <small className="field-hint">{uk.passwordHint}</small>
        </Field>
        {!online && (
          <p className="notice" role="status">
            {uk.offline}
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary full" disabled={isSubmitting || !online}>
          {isSubmitting ? uk.wait : uk.register}
          <ArrowRight size={19} />
        </button>
      </form>
    );
  }
}
export function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {error && (
        <small className="field-error" role="alert">
          {error}
        </small>
      )}
    </label>
  );
}
