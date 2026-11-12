import type { BrowserWindow, Menu } from 'electron';

import type { IMenuPlatform, MenuOptions } from '@/menus';
import { createMenuImpl } from '@/menus';
import { createLogger } from '@/utils/logger';

import type { App } from '../App';

// Create logger
const logger = createLogger('core:MenuManager');

export class MenuManager {
  app: App;
  private platformImpl: IMenuPlatform;

  constructor(app: App) {
    logger.debug('Initializing MenuManager');
    this.app = app;
    this.platformImpl = createMenuImpl(app);
  }

  /**
   * Initialize menus (mainly application menu)
   */
  initialize(options?: MenuOptions) {
    logger.info('Initializing application menu');
    this.platformImpl.buildAndSetAppMenu(options);
  }

  /**
   * Build and show context menu
   */
  showContextMenu(type: string, data?: any, window?: BrowserWindow) {
    logger.debug(`Showing context menu of type: ${type}`);
    const menu = this.platformImpl.buildContextMenu(type, data);
    if (window) menu.popup({ window });
    else menu.popup(); // popup must be called in main process
    return { success: true };
  }

  /**
   * Build tray menu (usually called by tray manager)
   */
  buildTrayMenu(): Menu {
    logger.debug('Building tray menu');
    return this.platformImpl.buildTrayMenu();
  }

  /**
   * Refresh menus
   */
  refreshMenus(options?: MenuOptions) {
    logger.debug('Refreshing all menus');
    this.platformImpl.refresh(options);

    // The Electron Tray keeps the Menu instance that was attached at startup.
    // Rebuild and replace it after a locale change so tray labels follow i18n.
    const mainTray = this.app.trayManager.getMainTray();
    if (mainTray) {
      mainTray.setMenu(this.platformImpl.buildTrayMenu());
    }

    return { success: true };
  }

  /**
   * Rebuild and set application menu (e.g., when toggling dev menu visibility)
   */
  rebuildAppMenu(options?: MenuOptions) {
    logger.debug('Rebuilding application menu');
    this.platformImpl.buildAndSetAppMenu(options);
    return { success: true };
  }
}
