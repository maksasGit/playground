import { resolve } from 'node:path';
import { config, root } from './config.js';
import { openDatabase } from './database.js';
const database = openDatabase(resolve(root, config.DATABASE_PATH));
database.sqlite.close();
console.log('Database migrations applied.');
