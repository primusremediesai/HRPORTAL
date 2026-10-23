require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const { startDatabase, stopDatabase, seedAdmin } = require('../services/dbEngine');

const command = process.argv[2];

(async () => {
  try {
    await startDatabase();

    if (command === 'seed') {
      await seedAdmin();
      console.log('Database seeded successfully.');
    } else if (command === 'backup') {
      const backupDir = path.resolve(__dirname, '..', 'backups', `backup-${Date.now()}`);
      fs.mkdirSync(backupDir, { recursive: true });

      const collections = await mongoose.connection.db.collections();
      for (const col of collections) {
        const docs = await col.find({}).toArray();
        fs.writeFileSync(
          path.join(backupDir, `${col.collectionName}.json`),
          JSON.stringify(docs, null, 2)
        );
        console.log(`Backed up ${col.collectionName}: ${docs.length} records`);
      }
      console.log(`\nBackup completed at: ${backupDir}`);
    } else if (command === 'reset') {
      console.log('Resetting database collections...');
      const collections = await mongoose.connection.db.collections();
      for (const col of collections) {
        await col.drop();
      }
      console.log('Collections cleared. Re-seeding admin...');
      await seedAdmin();
      console.log('Database reset complete.');
    } else {
      console.log('Usage: node scripts/dbTools.js [seed|backup|reset]');
    }

    await stopDatabase();
    process.exit(0);
  } catch (err) {
    console.error('dbTools error:', err);
    process.exit(1);
  }
})();
