import Database from 'better-sqlite3';

export interface SessionRow {
  teamsConversationId: string;
  claudeSessionId: string;
  cwd: string;
  status: 'active' | 'ended';
}

export class SessionStore {
  private db: Database.Database;
  constructor(path: string) {
    this.db = new Database(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        teams_conversation_id TEXT PRIMARY KEY,
        claude_session_id TEXT NOT NULL,
        cwd TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at INTEGER NOT NULL,
        last_activity INTEGER NOT NULL
      )`);
  }
  getActive(threadId: string): SessionRow | undefined {
    const r = this.db.prepare(
      `SELECT * FROM sessions WHERE teams_conversation_id = ? AND status = 'active'`
    ).get(threadId) as any;
    if (!r) return undefined;
    return { teamsConversationId: r.teams_conversation_id, claudeSessionId: r.claude_session_id, cwd: r.cwd, status: r.status };
  }
  upsert(threadId: string, sessionId: string, cwd: string): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO sessions (teams_conversation_id, claude_session_id, cwd, status, created_at, last_activity)
      VALUES (?, ?, ?, 'active', ?, ?)
      ON CONFLICT(teams_conversation_id) DO UPDATE SET
        claude_session_id = excluded.claude_session_id,
        cwd = excluded.cwd,
        status = 'active',
        last_activity = excluded.last_activity
    `).run(threadId, sessionId, cwd, now, now);
  }
  end(threadId: string): void {
    this.db.prepare(`UPDATE sessions SET status = 'ended' WHERE teams_conversation_id = ?`).run(threadId);
  }
  close(): void { this.db.close(); }
}
