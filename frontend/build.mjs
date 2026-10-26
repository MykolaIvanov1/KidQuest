// The shared backend .env uses NODE_ENV=development for local API work.
// Set the production mode before Vite reads it so PWA and React production code are included.
process.env.NODE_ENV = 'production';
const { build } = await import('vite');
await build();
