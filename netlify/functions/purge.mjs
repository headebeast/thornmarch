// Runs once a day: deletes usage sessions older than the retention period (90 days unless ANALYTICS_RETENTION_DAYS says otherwise).
import { analytics } from '../lib/common.mjs';

export const config = { schedule: '@daily' };

export default async () => {
  const { json } = await analytics().purge();
  console.log(`purged ${json.removed} old sessions`);
};
