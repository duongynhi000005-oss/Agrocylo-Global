import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';

const { mockVerifySession } = vi.hoisted(() => ({
  mockVerifySession: vi.fn(),
}));

vi.mock('../services/walletAuthService.js', () => ({
  verifySession: mockVerifySession,
}));

vi.mock('express-rate-limit', () => ({
  default: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock('../services/wsServer.js', () => ({
  broadcast: vi.fn(),
  broadcastTo: vi.fn(),
  attachWebSocketServer: vi.fn(),
  closeWebSocketServer: vi.fn(),
  drainWebSocketServer: vi.fn(),
  getWsClientCount: vi.fn(() => 0),
}));

vi.mock('../services/sorobanRpc.js', () => ({
  server: {
    getLatestLedger: vi.fn().mockResolvedValue({ sequence: 12345 }),
  },
}));

vi.mock('../events/watcher.js', () => ({
  startProductionWatcher: vi.fn().mockResolvedValue(null),
}));

vi.mock('../config/database.js', () => ({
  default: { end: vi.fn(), query: vi.fn() },
}));

vi.mock('../db/client.js', () => ({
  prisma: {
    transaction: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    eventCursor: {
      findFirst: vi.fn(),
    },
    campaign: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn(), upsert: vi.fn() },
    investment: { findMany: vi.fn(), create: vi.fn() },
    order: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    user: { upsert: vi.fn(), findUnique: vi.fn() },
    dispute: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn() },
    $queryRaw: vi.fn(),
  },
  connectDB: vi.fn(),
  disconnectDB: vi.fn(),
  isPrismaHealthy: vi.fn(),
}));

import app from '../app.js';
import { prisma } from '../db/client.js';

const WALLET = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const TX_HASH = 'abcd1234ef567890abcd1234ef567890abcd1234ef567890abcd1234ef567890';
const REQUEST_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';

describe('Transaction Migration & Schema Verification (Issue #1250)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifySession.mockResolvedValue({
      walletAddress: WALLET,
      sessionToken: 'valid-token',
    });
  });

  describe('Migration File Integrity', () => {
    const migrationDir = path.resolve(__dirname, '../../prisma/migrations');

    it('has an additive migration defining TransactionStatus enum, walletAddress, and status', () => {
      const dirs = fs.readdirSync(migrationDir);
      const targetDir = dirs.find((d) => d.includes('add_transaction_wallet_and_status'));
      expect(targetDir).toBeDefined();

      const sqlContent = fs.readFileSync(path.join(migrationDir, targetDir!, 'migration.sql'), 'utf-8');

      // Verify enum definition
      expect(sqlContent).toContain('CREATE TYPE "TransactionStatus" AS ENUM');
      expect(sqlContent).toContain("'awaiting_signature'");
      expect(sqlContent).toContain("'submitted'");
      expect(sqlContent).toContain("'confirmed'");
      expect(sqlContent).toContain("'indexed'");
      expect(sqlContent).toContain("'failed'");

      // Verify table alteration with default status backfill
      expect(sqlContent).toContain('ALTER TABLE "transactions"');
      expect(sqlContent).toContain('"walletAddress" TEXT');
      expect(sqlContent).toContain('"status" "TransactionStatus" NOT NULL DEFAULT \'submitted\'');

      // Verify indexes
      expect(sqlContent).toContain('CREATE INDEX "transactions_walletAddress_idx" ON "transactions"("walletAddress")');
      expect(sqlContent).toContain('CREATE INDEX "transactions_txHash_idx" ON "transactions"("txHash")');
    });

    it('matches schema.prisma definitions exactly', () => {
      const schemaPath = path.resolve(__dirname, '../../prisma/schema.prisma');
      const schemaContent = fs.readFileSync(schemaPath, 'utf-8');

      // Check model Transaction has all fields
      expect(schemaContent).toMatch(/model\s+Transaction\s+\{[\s\S]*?walletAddress\s+String\?/);
      expect(schemaContent).toMatch(/model\s+Transaction\s+\{[\s\S]*?status\s+TransactionStatus\s+@default\(submitted\)/);
      expect(schemaContent).toMatch(/model\s+Transaction\s+\{[\s\S]*?@@index\(\[walletAddress\]\)/);
      expect(schemaContent).toMatch(/model\s+Transaction\s+\{[\s\S]*?@@index\(\[txHash\]\)/);

      // Check enum TransactionStatus has all values
      expect(schemaContent).toMatch(/enum\s+TransactionStatus\s+\{[\s\S]*?awaiting_signature[\s\S]*?submitted[\s\S]*?confirmed[\s\S]*?indexed[\s\S]*?failed/);
    });
  });

  describe('Route Handlers against Migrated Schema', () => {
    it('creates a transaction with initial awaiting_signature status and walletAddress', async () => {
      const createdTx = {
        id: REQUEST_ID,
        campaignId: null,
        walletAddress: WALLET,
        eventType: 'transaction.submitted',
        status: 'awaiting_signature',
        payload: {},
        ledger: 0,
        eventIndex: 0,
        txHash: TX_HASH,
        processedAt: new Date('2026-08-29T00:00:00Z'),
      };

      (prisma.transaction.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (prisma.transaction.create as ReturnType<typeof vi.fn>).mockResolvedValue(createdTx);

      const res = await request(app)
        .post('/api/v1/transactions')
        .set('Authorization', 'Bearer valid-token')
        .send({
          requestId: REQUEST_ID,
          walletAddress: WALLET,
          txHash: TX_HASH,
        });

      expect(res.status).toBe(201);
      expect(res.body.requestId).toBe(REQUEST_ID);
      expect(res.body.walletAddress).toBe(WALLET);
      expect(res.body.status).toBe('awaiting_signature');
      expect(res.body.txHash).toBe(TX_HASH);

      expect(prisma.transaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: REQUEST_ID,
          walletAddress: WALLET,
          status: 'awaiting_signature',
          txHash: TX_HASH,
        }),
      });
    });

    it('lists transactions filtered by walletAddress and sorted by processedAt', async () => {
      const mockList = [
        {
          id: REQUEST_ID,
          campaignId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
          walletAddress: WALLET,
          eventType: 'investment.submitted',
          status: 'confirmed',
          ledger: 100,
          txHash: TX_HASH,
          processedAt: new Date('2026-08-29T10:00:00Z'),
        },
      ];

      (prisma.transaction.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(mockList);

      const res = await request(app)
        .get('/api/v1/transactions')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0].walletAddress).toBe(WALLET);
      expect(res.body[0].status).toBe('confirmed');

      expect(prisma.transaction.findMany).toHaveBeenCalledWith({
        where: { walletAddress: WALLET },
        orderBy: { processedAt: 'desc' },
        take: 50,
      });
    });

    it('transitions status from submitted to confirmed on PATCH /transactions/:requestId/status', async () => {
      const existingTx = {
        id: REQUEST_ID,
        walletAddress: WALLET,
        status: 'submitted',
        txHash: TX_HASH,
        eventType: 'transaction.submitted',
        campaignId: null,
        ledger: 100,
        processedAt: new Date('2026-08-29T00:00:00Z'),
      };

      const updatedTx = {
        ...existingTx,
        status: 'confirmed',
      };

      (prisma.transaction.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(existingTx);
      (prisma.transaction.update as ReturnType<typeof vi.fn>).mockResolvedValue(updatedTx);

      const res = await request(app)
        .patch(`/api/v1/transactions/${REQUEST_ID}/status`)
        .set('Authorization', 'Bearer valid-token')
        .send({
          status: 'confirmed',
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('confirmed');
      expect(prisma.transaction.update).toHaveBeenCalledWith({
        where: { id: REQUEST_ID },
        data: expect.objectContaining({ status: 'confirmed' }),
      });
    });

    it('handles pre-migration legacy transaction defaulting to submitted', async () => {
      const legacyTx = {
        id: REQUEST_ID,
        campaignId: null,
        walletAddress: WALLET,
        eventType: 'campaign.created',
        status: 'submitted', // Backfilled status
        ledger: 50,
        txHash: TX_HASH,
        processedAt: new Date('2026-04-25T00:00:00Z'),
      };

      (prisma.transaction.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(legacyTx);

      const res = await request(app)
        .get(`/api/v1/transactions/${REQUEST_ID}`)
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('submitted');
      expect(res.body.walletAddress).toBe(WALLET);
    });
  });
});
