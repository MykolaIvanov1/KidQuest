import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { configureFirebaseFromFiles, FirebaseConfigurationError } from './firebase-config.mjs';

const usage = `KidQuest Firebase setup (local files only; no external requests)

  pnpm setup:firebase --service-account PATH --web-config PATH [--replace]

service-account: private JSON downloaded from Firebase Console, retained locally.
web-config: JSON with apiKey, projectId, messagingSenderId, appId and public vapidKey.
Outputs: .local/firebase/server.env, web.env and manifest.json.
Existing generated files are preserved unless --replace is explicitly supplied.
Private values, input contents and keys are never printed. The main .env is not changed.
`;
try {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        'service-account': { type: 'string' },
        'web-config': { type: 'string' },
        replace: { type: 'boolean', default: false },
        help: { type: 'boolean' },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    throw new FirebaseConfigurationError('arguments; use --help');
  }
  if (values.help) console.log(usage);
  else {
    if (!values['service-account'] || !values['web-config'])
      throw new FirebaseConfigurationError('arguments; use --help');
    const root = fileURLToPath(new URL('..', import.meta.url));
    const result = await configureFirebaseFromFiles({
      serviceAccountFile: path.resolve(root, values['service-account']),
      webConfigFile: path.resolve(root, values['web-config']),
      replace: values.replace,
    });
    console.log('Firebase configuration saved locally for project ' + result.projectId + '.');
    console.log(
      'Generated: .local/firebase/server.env, web.env and manifest.json. No services were started.',
    );
    if (result.backupDirectory)
      console.log('Previous generated configuration was retained in a private local backup.');
  }
} catch (error) {
  console.error(
    error instanceof FirebaseConfigurationError
      ? error.message
      : 'Firebase setup failed. Check the local input files.',
  );
  process.exitCode = 1;
}
