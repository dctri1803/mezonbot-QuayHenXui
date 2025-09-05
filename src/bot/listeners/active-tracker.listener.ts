import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ChannelMessage, Events } from 'mezon-sdk';
import { ActiveUsersService } from '../services/active-users.service';

@Injectable()
export class ActiveTrackerListener {
  constructor(private active: ActiveUsersService) { }

  @OnEvent(Events.ChannelMessage)
  onMessage(msg: ChannelMessage) {
    if (msg.code) return;
    if (!msg.channel_id || !msg.sender_id) return;
    const name = (msg as any).display_name || (msg as any).username;
    this.active.touch(msg.channel_id, msg.sender_id, name);
  }
}
