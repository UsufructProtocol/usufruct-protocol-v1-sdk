/**************************************************************
 * THIS FILE IS GENERATED AND SHOULD NOT BE MANUALLY MODIFIED *
 **************************************************************/
import { MoveEnum, MoveStruct } from '../utils/index.js';
import * as monetary from './monetary.js';
import * as math from './math.js';
const $moduleName = '@local-pkg/usufruct::price_escalation_policy';
export const PriceEscalationPolicy = new MoveEnum({ name: `${$moduleName}::PriceEscalationPolicy`, fields: {
        FixedDelta: new MoveStruct({ name: `PriceEscalationPolicy.FixedDelta`, fields: {
                delta: monetary.Price
            } }),
        CompoundDelta: new MoveStruct({ name: `PriceEscalationPolicy.CompoundDelta`, fields: {
                bps: math.BasisPoints,
                delta: monetary.Price
            } })
    } });