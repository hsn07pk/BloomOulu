import { prisma } from '@bloomoulu/db';
import { Queue } from 'bullmq';

async function main() {
  // Re-use any pending request for this user, else create a fresh one.
  let req = await prisma.dataExportRequest.findFirst({
    where: {
      userId: 'cd66b0db-c565-4611-840d-1632410dfeb8',
      status: 'pending',
    },
    orderBy: { createdAt: 'desc' },
  });
  if (!req) {
    req = await prisma.dataExportRequest.create({
      data: { userId: 'cd66b0db-c565-4611-840d-1632410dfeb8', status: 'pending' },
    });
  }
  console.log('Export request', req.id, 'status', req.status);
  const queue = new Queue('gdpr-export', {
    connection: { url: process.env.REDIS_URL ?? 'redis://localhost:6379' },
  });
  const job = await queue.add(
    'export',
    { requestId: req.id },
    { attempts: 3, backoff: { type: 'exponential', delay: 5_000 } },
  );
  console.log('Enqueued job', job.id);
  await queue.close();
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
