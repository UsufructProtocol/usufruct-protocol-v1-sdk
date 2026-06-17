/**************************************************************
 * THIS FILE IS GENERATED AND SHOULD NOT BE MANUALLY MODIFIED *
 **************************************************************/
import { MoveEnum, MoveStruct } from '../utils/index.js';
import * as phases from './phases.js';
const $moduleName = '@local-pkg/usufruct::auction_window_policy';
export const AuctionWindowPolicy = new MoveEnum({ name: `${$moduleName}::AuctionWindowPolicy`, fields: {
        Off: null,
        Fixed: new MoveStruct({ name: `AuctionWindowPolicy.Fixed`, fields: {
                ceiling: phases.Duration
            } })
    } });