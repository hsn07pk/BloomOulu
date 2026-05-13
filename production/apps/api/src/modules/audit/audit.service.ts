import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export interface AuditEntry {
  actorUserId?: string | null;
  action: string;
  resource: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Write inside a Prisma transaction. Use this everywhere a state change
   *  is committed; the audit row lives in the SAME transaction so a crash
   *  between business write and audit write is impossible. */
  async log(tx: Prisma.TransactionClient | PrismaService, entry: AuditEntry) {
    await tx.auditLog.create({
      data: {
        actorUserId: entry.actorUserId ?? null,
        action: entry.action,
        resource: entry.resource,
        before: (entry.before as any) ?? undefined,
        after: (entry.after as any) ?? undefined,
        ip: entry.ip ?? null,
        userAgent: entry.userAgent ?? null,
      },
    });
  }
}
