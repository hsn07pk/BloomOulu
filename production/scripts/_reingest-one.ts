import { PrismaClient } from '@prisma/client';
import { ingestPlantIntoRag } from '../apps/admin/src/rag-ingest.js';

async function main() {
  const p = new PrismaClient();
  const id = process.argv[2];
  if (!id) { console.error('usage: _reingest-one.ts <plantId>'); process.exit(1); }
  await ingestPlantIntoRag(p, id);
  console.log('enqueued for', id);
  await p.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
