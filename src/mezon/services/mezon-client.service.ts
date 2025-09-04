import { Injectable, Logger } from '@nestjs/common';
import { MezonClient } from 'mezon-sdk';

@Injectable()
export class MezonClientService {
  private readonly logger = new Logger(MezonClientService.name);
  private client: MezonClient;

  constructor(token: string) {
    this.client = new MezonClient(token);
  }

  async initializeClient() {
    try {
      const result = await this.client.login();
      this.logger.log('authenticated.', result);
    } catch (error) {
      if (error instanceof Response) {
        const text = await error.text?.();
        this.logger.error('error authenticating. Response:', text);
      } else {
        this.logger.error('error authenticating.', error);
      }
      throw error;
    }
  }

  getClient() {
    return this.client;
  }
}
