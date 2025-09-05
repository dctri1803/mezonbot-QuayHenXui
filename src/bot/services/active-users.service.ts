import { Injectable } from '@nestjs/common';

type SeenInfo = { ts: number; name?: string };
@Injectable()
export class ActiveUsersService {
  private channels: Map<string, Map<string, SeenInfo>> = new Map();

  touch(channelId: string, userId: string, name?: string) {
    if (!channelId || !userId) return;
    if (!this.channels.has(channelId)) this.channels.set(channelId, new Map());
    this.channels.get(channelId)!.set(userId, { ts: Date.now(), name });
  }

  listActive(channelId: string, withinMs = 15 * 60 * 1000) {
    const now = Date.now();
    const m = this.channels.get(channelId);
    if (!m) return [];
    return Array.from(m.entries())
      .filter(([_, v]) => now - v.ts <= withinMs)
      .map(([uid]) => uid);
  }

  /** Tìm user theo tên hiển thị/username trong “người đang hoạt động” của kênh */
  findByName(channelId: string, query: string, withinMs = 60 * 60 * 1000) {
    const now = Date.now();
    const m = this.channels.get(channelId);
    if (!m) return [];
    const q = (query || '').toLowerCase().trim();
    const hits: string[] = [];
    for (const [uid, info] of m.entries()) {
      if (now - info.ts > withinMs) continue;
      const n = (info.name || '').toLowerCase();
      if (!n) continue;
      if (n === q || n.startsWith(q) || n.includes(q)) hits.push(uid);
    }
    return hits;
  }

  getName(channelId: string, userId: string) {
    return this.channels.get(channelId)?.get(userId)?.name;
  }
  
  prune(withinMs = 60 * 60 * 1000) {
    const now = Date.now();
    for (const [cid, m] of this.channels.entries()) {
      for (const [uid, info] of Array.from(m.entries())) {
        if (now - info.ts > withinMs) m.delete(uid);
      }
      if (m.size === 0) this.channels.delete(cid);
    }
  }
}
