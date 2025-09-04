import { Injectable } from '@nestjs/common';

type SeenMap = Map<string, number>;

@Injectable()
export class ActiveUsersService {
  private channels: Map<string, SeenMap> = new Map();

  touch(channelId: string, userId: string) {
    if (!channelId || !userId) return;
    if (!this.channels.has(channelId)) this.channels.set(channelId, new Map());
    this.channels.get(channelId)!.set(userId, Date.now());
  }

  listActive(channelId: string, withinMs = 15 * 60 * 1000) {
    const now = Date.now();
    const m = this.channels.get(channelId);
    if (!m) return [];
    return Array.from(m.entries())
      .filter(([_, ts]) => now - ts <= withinMs)
      .map(([uid]) => uid);
  }

  prune(withinMs = 60 * 60 * 1000) {
    const now = Date.now();
    for (const [cid, m] of this.channels.entries()) {
      for (const [uid, ts] of Array.from(m.entries())) {
        if (now - ts > withinMs) m.delete(uid);
      }
      if (m.size === 0) this.channels.delete(cid);
    }
  }
}
