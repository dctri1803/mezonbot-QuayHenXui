export interface TokenPort {
  /** Lấy số dư của user */
  getBalance(userId: string): Promise<number>;

  /**
   * Chuyển token từ from → to (amount > 0).
   * Yêu cầu: throw lỗi nếu không đủ tiền hoặc chuyển thất bại.
   */
  transfer(fromUserId: string, toUserId: string, amount: number, memo?: string): Promise<void>;
}
