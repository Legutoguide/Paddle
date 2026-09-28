import type Database from 'better-sqlite3';
import { AuditService } from './auditService';

// Branches are a lightweight LOCAL tag/category (e.g. "Tunis", "Sousse")
// for a single-device install — not multi-device/cloud sync. They exist so
// coupons and history can be categorized within this one local database.

export interface Branch {
  id: number;
  name: string;
  notes: string | null;
  createdAt: string;
}

export class BranchValidationError extends Error {}
export class BranchNotFoundError extends Error {}
export class BranchInUseError extends Error {}

interface BranchRow {
  id: number;
  name: string;
  notes: string | null;
  created_at: string;
}

function mapBranch(row: BranchRow): Branch {
  return { id: row.id, name: row.name, notes: row.notes, createdAt: row.created_at };
}

export class BranchService {
  private audit: AuditService;

  constructor(private db: Database.Database) {
    this.audit = new AuditService(db);
  }

  create(input: { name: string; notes?: string | null }): Branch {
    const name = input.name.trim();
    if (!name) throw new BranchValidationError('Branch name is required');

    const existing = this.db.prepare<[string], { c: number }>(`SELECT COUNT(*) as c FROM branches WHERE name = ?`).get(name);
    if (existing && existing.c > 0) throw new BranchValidationError('A branch with this name already exists');

    const result = this.db.prepare(`INSERT INTO branches (name, notes) VALUES (?, ?)`).run(name, input.notes ?? null);
    this.audit.log('BRANCH_CREATED', 'branch', Number(result.lastInsertRowid), { name });
    return this.getById(Number(result.lastInsertRowid))!;
  }

  getById(id: number): Branch | null {
    const row = this.db.prepare<[number], BranchRow>(`SELECT * FROM branches WHERE id = ?`).get(id);
    return row ? mapBranch(row) : null;
  }

  list(): Branch[] {
    const rows = this.db.prepare<[], BranchRow>(`SELECT * FROM branches ORDER BY name COLLATE NOCASE ASC`).all();
    return rows.map(mapBranch);
  }

  update(id: number, input: { name?: string; notes?: string | null }): Branch {
    const existing = this.getById(id);
    if (!existing) throw new BranchNotFoundError(`Branch ${id} not found`);
    const name = input.name !== undefined ? input.name.trim() : existing.name;
    if (!name) throw new BranchValidationError('Branch name is required');

    this.db.prepare(`UPDATE branches SET name = ?, notes = ? WHERE id = ?`).run(
      name,
      input.notes !== undefined ? input.notes : existing.notes,
      id
    );
    this.audit.log('BRANCH_UPDATED', 'branch', id, input);
    return this.getById(id)!;
  }

  delete(id: number): void {
    const existing = this.getById(id);
    if (!existing) throw new BranchNotFoundError(`Branch ${id} not found`);

    const inUse = this.db.prepare<[number], { c: number }>(`SELECT COUNT(*) as c FROM coupons WHERE branch_id = ?`).get(id)!;
    if (inUse.c > 0) {
      throw new BranchInUseError('This branch has coupons tagged with it and cannot be deleted.');
    }

    this.db.prepare(`DELETE FROM branches WHERE id = ?`).run(id);
    this.audit.log('BRANCH_DELETED', 'branch', id, { name: existing.name });
  }
}

