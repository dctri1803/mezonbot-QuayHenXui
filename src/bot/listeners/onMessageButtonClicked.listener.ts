import { OnEvent } from '@nestjs/event-emitter';
import { Events } from 'mezon-sdk';
import { Injectable } from '@nestjs/common';
import { RoleService } from '../commands/selfAssignableRoles/role.service';

@Injectable()
export class ListenerMessageButtonClicked {
  constructor(private roleService: RoleService) {}

  @OnEvent(Events.MessageButtonClicked)
  async hanndleButtonForm(data: any) {
    try {
      const [buttonConfirmType] = String(data.button_id || '').split('_');

      switch (buttonConfirmType) {
        case 'role':
          return this.handleSelectRole(data);
        default:
          return;
      }
    } catch (error) {
      console.log('hanndleButtonForm ERROR', error);
    }
  }

  async handleSelectRole(data: any) {
    try {
      await this.roleService.handleSelectRole(data);
    } catch (error) {
      console.log('ERORR handleSelectPoll', error);
    }
  }
}
