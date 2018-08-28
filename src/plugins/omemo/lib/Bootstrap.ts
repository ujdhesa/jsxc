import Store from './Store'
import { KeyHelper } from "../vendor/KeyHelper";
import Random from '../../../util/Random'
import Log from '../../../util/Log'
import BundleManager from './BundleManager';

export default class Bootstrap {
   constructor(private deviceName: string, private store: Store, private bundleManager: BundleManager) {

   }

   public async prepare(): Promise<void> {
      if (!this.store.isPublished()) {
         if (!this.store.isReady()) {
            await this.setup();
         }

         let identityKey = await this.store.getLocalIdentityKey();
         let bundle = await this.bundleManager.generateBundle(identityKey);
         let deviceId = this.store.getLocalDeviceId();

         await this.bundleManager.publishBundle(deviceId, bundle);
      }

      Log.debug('Local device prepared.');
   }

   private setup(): Promise<void> {
      return Promise.all([
         this.generateDeviceId(),
         this.getDeviceName(),
         KeyHelper.generateIdentityKey(),
         KeyHelper.generateRegistrationId(),
      ]).then(([deviceId, deviceName, identityKey, registrationId]) => {
         this.store.setLocalDeviceId(deviceId);
         this.store.setLocalDeviceName(deviceName);
         this.store.setLocalIdentityKey(identityKey);
         this.store.setLocalRegistrationId(registrationId);
      });
   }

   private generateDeviceId(): Promise<number> {
      return Promise.resolve(Random.number(Math.pow(2, 31) - 1, 1));
   }

   private getDeviceName(): Promise<string> {
      return Promise.resolve(this.deviceName);
   }
}
