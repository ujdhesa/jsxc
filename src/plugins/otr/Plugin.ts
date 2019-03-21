import { EncryptionState } from '../../plugin/AbstractPlugin'
import PluginAPI from '../../plugin/PluginAPI'
import { EncryptionPlugin } from '../../plugin/EncryptionPlugin'
import Contact from '../../Contact'
import Message from '../../Message'
import Session from './Session'
import DSA from 'otr/lib/dsa'
import Options from '../../Options'

import dsaWebworkerFile = require('otr/build/dsa-webworker.js?path')
import ChatWindow from '@ui/ChatWindow';
import { ContactType, IContact } from '@src/Contact.interface';
import Translation from '@util/Translation';
import VerificationDialog from '@ui/dialogs/verification';

const WHITESPACE_TAG = '\x20\x09\x20\x20\x09\x09\x09\x09\x20\x09\x20\x09\x20\x09\x20\x20';

interface IDSA {
   parsePrivate
   createInWebWorker
   packPrivate
}

Options.addDefaults({
   otr: {
      ERROR_START_AKE: false,
      debug: false,
      SEND_WHITESPACE_TAG: false,
      WHITESPACE_START_AKE: true
   }
});

const MIN_VERSION = '4.0.0';
const MAX_VERSION = '4.0.0';

export default class OTRPlugin extends EncryptionPlugin {
   private sessions = {};
   private key: IDSA;

   public static getName(): string {
      return 'otr';
   }

   constructor(pluginAPI: PluginAPI) {
      super(MIN_VERSION, MAX_VERSION, pluginAPI);

      pluginAPI.getStorage().registerHook('key', (key) => {
         if (this.key && this.key !== key) {
            this.pluginAPI.Log.warn('Something went wrong. We have two different DSA keys.');
         }

         this.key = key;
      });

      pluginAPI.addAfterReceiveMessageProcessor(this.afterReceiveMessageProcessor);
      pluginAPI.addPreSendMessageProcessor(this.preSendMessageProcessor);

      pluginAPI.registerChatWindowInitializedHook((chatWindow: ChatWindow) => {
         let contact = chatWindow.getContact();

         if (contact.getType() !== ContactType.CHAT) {
            return;
         }

         //@TODO enable/disable according to encryption state
         chatWindow.addMenuEntry('otr-verification', 'OTR ' + Translation.t('Verification'), () => this.openVerificationDialog(contact));
      });
   }

   public toggleTransfer(contact: Contact): Promise<void> {
      return this.getSession(contact).then((session: Session) => {
         if (session.isEnded()) {
            return session.end();
         } else if (session.isEncrypted()) {
            return session.goPlain();
         } else {
            return session.goEncrypted();
         }
      });
   }

   private afterReceiveMessageProcessor = (contact: Contact, message: Message, stanza: Element) => {
      let plaintextMessage = message.getPlaintextMessage();
      if (!plaintextMessage || (!/^\?OTR/.test(plaintextMessage) && plaintextMessage.indexOf(WHITESPACE_TAG) < 0)) {
         return Promise.resolve([contact, message, stanza]);
      }

      return this.getSession(contact).then((session: Session) => {
         return session.processMessage(message, 'decryptMessage');
      }).then((message) => {
         return [contact, message, stanza];
      });
   }

   private preSendMessageProcessor = (contact: Contact, message: Message) => {
      if (contact.getEncryptionState() === EncryptionState.Plaintext || contact.getEncryptionPluginName() !== OTRPlugin.getName()) {
         return Promise.resolve([contact, message]);
      }

      return this.getSession(contact).then((session: Session) => {
         if (session.isEnded()) {
            contact.addSystemMessage(Translation.t('your_message_wasnt_send_please_end_your_private_conversation'));

            throw new Error('OTR session is ended');
         } else if (session.isEncrypted()) {
            return session.processMessage(message, 'encryptMessage');
         } else {
            return message;
         }
      }).then((message) => {
         return [contact, message];
      });
   }

   public async openVerificationDialog(contact: IContact) {
      let session = await this.getSession(contact);

      new VerificationDialog(contact, session);
   }

   private getSession(contact: IContact): Promise<Session> {
      //@TODO only master (sure?)
      let bareJid = contact.getJid().bare;

      if (this.sessions.hasOwnProperty(bareJid)) {
         return Promise.resolve(this.sessions[bareJid]);
      }

      return this.getDSAKey().then((key) => {
         this.sessions[bareJid] = new Session(contact, key, this.pluginAPI.getStorage(), this.pluginAPI.getConnection());

         //@TODO save session?

         return this.sessions[bareJid];
      });
   }

   //@TODO call this before logout
   // private endAllSessions() {
   //    //@TODO restore all otr objects (?)

   //    let promiseMap = Object.keys(this.sessions).map((bareJid) => {
   //       let session = this.sessions[bareJid];

   //       if (session.isEncrypted()) {
   //          return session.end();
   //       }
   //    });

   //    return Promise.all(promiseMap);
   // }

   private getDSAKey() {
      if (this.key) {
         return Promise.resolve(this.key);
      }

      let storage = this.pluginAPI.getStorage();
      let storedKey = storage.getItem('key');

      if (!storedKey) {
         //@TODO we should generate only one key even if there are multiple calls during generation
         return this.generateDSAKey().then((key: IDSA) => {
            storage.setItem('key', key.packPrivate());

            this.key = key;

            return key;
         });
      } else {
         this.pluginAPI.Log.debug('DSA key loaded');
         this.key = (<IDSA> DSA).parsePrivate(storedKey);

         return Promise.resolve(this.key);
      }
   }

   private generateDSAKey(): Promise<{}> {
      if (typeof Worker === 'undefined') {
         //@TODO disable OTR
      }

      return new Promise((resolve, reject) => {
         this.pluginAPI.Log.debug('Start DSA key generation');

         (<IDSA> DSA).createInWebWorker({
            path: dsaWebworkerFile
         }, (key) => {
            this.pluginAPI.Log.debug('DSA key generated');

            resolve(key);
         });
      });
   }
}
