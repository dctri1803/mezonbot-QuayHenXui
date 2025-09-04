import { OnEvent } from '@nestjs/event-emitter';
import { ChannelMessage, Events } from 'mezon-sdk';
import { CommandBase } from '../base/command.handle';
import { Injectable } from '@nestjs/common';
import { ActiveUsersService } from '../services/active-users.service';

@Injectable()
export class ListenerChannelMessage {
  constructor(
    private commandBase: CommandBase,
    private activeUsersService: ActiveUsersService
  ) { }

  @OnEvent(Events.ChannelMessage)
  async handleCommand(message: ChannelMessage) {
    this.activeUsersService.touch(message.channel_id, message.sender_id);

    if (message.code) return;
    try {
      const content = message.content.t;
      if (typeof content == 'string' && content.trim()) {
        const firstLetter = content.trim()[0];
        switch (firstLetter) {
          case '$':
            await this.commandBase.execute(content, message);
            break;
          default:
            return;
        }
      }
    } catch (e) {
      console.log(e);
    }
  }
}
