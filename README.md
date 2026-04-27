# モチカタ — 忘れ物防止リマインダー

単一ユーザー向けPWA。授業前に「今日の持ち物」を通知して忘れ物を防ぐ。

## 開発

```bash
cp .env.example .env
docker compose up -d postgres
npm install
npx prisma migrate dev
npm run dev          # web (http://localhost:3000)
npm run worker:dev   # cron worker
```

## フェーズ別計画

計画書: `/Users/yoppy/.claude/plans/synthetic-sleeping-rossum.md`

### Phase 1 (MVP) — 4本柱
1. 手動タスク + 持ち物チェック
2. 繰り返しタスク
3. 授業時間割からの自動生成
4. Slack + Push 通知 + スヌーズ(1時間)

## スタック

Next.js 15 / TypeScript / Prisma / PostgreSQL / Tailwind / node-cron / rrule / iron-session / argon2 / web-push
