require('dotenv').config();
const { startDatabase, stopDatabase } = require('./services/dbEngine');

(async () => {
  try {
    console.log('--- Primus HR Management Portal Initialization ---');
    await startDatabase();

    const app = require('./server.js');
    const PORT = process.env.PORT || 3000;

    const server = app.listen(PORT, () => {
      console.log('====================================================');
      console.log(` Primus HR Portal Running Successfully!`);
      console.log(` Local URL: http://localhost:${PORT}/login.html`);
      console.log(` Storage:   Google Drive 5 TB Integration Ready`);
      console.log(` Database:  Persistent (saved to ./data/db)`);
      console.log('====================================================');
    });

    // Handle graceful shutdown
    const shutdown = async () => {
      console.log('\nGracefully stopping server and saving database...');
      server.close(async () => {
        await stopDatabase();
        console.log('Database safely persisted. Goodbye!');
        process.exit(0);
      });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

  } catch (err) {
    console.error('Fatal initialization error:', err);
    process.exit(1);
  }
})();
