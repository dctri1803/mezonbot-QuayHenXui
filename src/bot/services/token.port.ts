export interface TokenPort {
  getBalance(userId: string, amount?: number): Promise<number>;
  transfer(from: string, to: string, amount: number, memo?: string): Promise<void>;
  syncBalance(userId: string, amount: number): Promise<void>;
}