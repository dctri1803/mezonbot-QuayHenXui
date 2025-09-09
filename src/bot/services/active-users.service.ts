import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from 'src/bot/models/user.entity';

type SeenInfo = { ts: number; display_name?: string };

@Injectable()
export class ActiveUsersService {
  private channels: Map<string, Map<string, SeenInfo>> = new Map();

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  touch(channelId: string, userId: string, display_name?: string) {
    if (!channelId || !userId) return;
    if (!this.channels.has(channelId)) this.channels.set(channelId, new Map());
    this.channels.get(channelId)!.set(userId, { ts: Date.now(), display_name });
  }

  listActive(channelId: string, withinMs = 15 * 60 * 1000) {
    const now = Date.now();
    const m = this.channels.get(channelId);
    if (!m) return [];
    return Array.from(m.entries())
      .filter(([_, v]) => now - v.ts <= withinMs)
      .map(([uid]) => uid);
  }

  findByName(channelId: string, query: string, withinMs = 60 * 60 * 1000) {
    const now = Date.now();
    const m = this.channels.get(channelId);
    if (!m) return [];
    const q = (query || '').toLowerCase().trim();
    const hits: string[] = [];
    for (const [uid, info] of m.entries()) {
      if (now - info.ts > withinMs) continue;
      const n = (info.display_name || '').toLowerCase();
      if (!n) continue;
      if (n === q || n.startsWith(q) || n.includes(q)) hits.push(uid);
    }
    return hits;
  }

  getName(channelId: string, userId: string) {
    return this.channels.get(channelId)?.get(userId)?.display_name;
  }

  /** NEW: lấy tên, nếu cache không có thì query DB rồi cache lại */
  async getNameOrFetch(channelId: string, userId: string): Promise<string | undefined> {
    const cached = this.getName(channelId, userId);
    if (cached) return cached;

    const u = await this.userRepo
      .createQueryBuilder('u')
      .where('u.user_id::text = :uid', { uid: userId })
      .getOne();

    const name = u?.display_name || u?.username || undefined;
    if (name) this.touch(channelId, userId, name);
    return name;
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
