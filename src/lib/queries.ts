/**
 * Reusable query builders and helpers
 */

import type { Database } from "@ohcnetwork/leaderboard-api";

interface SlackAnonymousEodUpdate {
  id: number;
  user_id: string;
  timestamp: string;
  text: string;
}

/**
 * Anonymous EOD Update queries
 */
export const anonymousEodUpdateQueries = {
  async createTable(db: Database): Promise<void> {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS slack_anonymous_eod_update (
          id           BIGINT PRIMARY KEY,
          user_id      VARCHAR NOT NULL,
          timestamp    TIMESTAMP NOT NULL,
          text         TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_slack_anonymous_eod_update_timestamp ON slack_anonymous_eod_update (timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_slack_anonymous_eod_update_user_id ON slack_anonymous_eod_update (user_id);
      `);
  },
  /**
   * Get all anonymous EOD updates
   */
  async getAll(db: Database): Promise<SlackAnonymousEodUpdate[]> {
    const result = await db.execute(
      "SELECT * FROM slack_anonymous_eod_update ORDER BY timestamp DESC"
    );
    return result.rows as unknown as SlackAnonymousEodUpdate[];
  },

  /**
   * Get all anonymous EOD updates grouped by user_id
   */
  async getAllGroupedByUserId(
    db: Database
  ): Promise<Map<string, SlackAnonymousEodUpdate[]>> {
    const updates = await this.getAll(db);
    return updates.reduce((acc, update) => {
      acc.set(update.user_id, [...(acc.get(update.user_id) || []), update]);
      return acc;
    }, new Map<string, SlackAnonymousEodUpdate[]>());
  },

  /**
   * Upsert an anonymous EOD update
   */
  async upsert(db: Database, update: SlackAnonymousEodUpdate): Promise<void> {
    await db.execute(
      `INSERT INTO slack_anonymous_eod_update (id, user_id, timestamp, text) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        user_id = excluded.user_id,
        timestamp = excluded.timestamp,
        text = excluded.text
      `,
      [update.id, update.user_id, update.timestamp, update.text]
    );
  },

  /**
   * Delete an anonymous EOD update
   */
  async delete(db: Database, id: number): Promise<void> {
    await db.execute("DELETE FROM slack_anonymous_eod_update WHERE id = ?", [
      id,
    ]);
  },
};

export const getContributorUsernamesBySlackUserIds = async (
  db: Database,
  userIds: string[]
): Promise<Map<string, string>> => {
  if (userIds.length === 0) {
    return new Map<string, string>();
  }

  // Build placeholders for IN clause: (?, ?, ?)
  const placeholders = userIds.map(() => "?").join(", ");
  const query = `SELECT username, meta->>'slack_user_id' AS slack_user_id FROM contributor WHERE meta->>'slack_user_id' IN (${placeholders})`;

  const contributors = await db.execute(query, userIds);

  const contributorMap = new Map<string, string>();
  for (const contributor of contributors.rows) {
    contributorMap.set(
      contributor.slack_user_id as string,
      contributor.username as string
    );
  }
  return contributorMap;
};
