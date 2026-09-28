import { openDatabase } from '../../src/main/db/connection';
import type Database from 'better-sqlite3';

export function createTestDb(): Database.Database {
  return openDatabase(':memory:');
}
