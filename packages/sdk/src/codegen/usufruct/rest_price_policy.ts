/**************************************************************
 * THIS FILE IS GENERATED AND SHOULD NOT BE MANUALLY MODIFIED *
 **************************************************************/
import { MoveEnum, MoveStruct } from '../utils/index.js';
import * as monetary from './monetary.js';
const $moduleName = '@local-pkg/usufruct::rest_price_policy';
export const RestPricePolicy = new MoveEnum({ name: `${$moduleName}::RestPricePolicy`, fields: {
        Fixed: new MoveStruct({ name: `RestPricePolicy.Fixed`, fields: {
                price: monetary.Price
            } })
    } });