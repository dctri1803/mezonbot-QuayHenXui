import { Injectable } from '@nestjs/common';
import { TokenPort } from './token.port';

@Injectable()
export class InMemoryTokenPort implements TokenPort {
  private balances = new Map<string, number>();
  private defaultInit = 1000; // mỗi người khởi tạo 1000 token để test

  private ensure(u: string) {
    if (!this.balances.has(u)) this.balances.set(u, this.defaultInit);
  }

  async getBalance(userId: string): Promise<number> {
    this.ensure(userId);
    return this.balances.get(userId)!;
  }

  async transfer(from: string, to: string, amount: number, memo?: string): Promise<void> {
    if (amount <= 0) throw new Error('INVALID_AMOUNT');
    this.ensure(from);
    this.ensure(to);
    const fb = this.balances.get(from)!;
    if (fb < amount) throw new Error('INSUFFICIENT_FUNDS');
    this.balances.set(from, fb - amount);
    this.balances.set(to, this.balances.get(to)! + amount);
  }
}
