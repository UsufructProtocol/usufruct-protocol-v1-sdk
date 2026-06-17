/**************************************************************
 * THIS FILE IS GENERATED AND SHOULD NOT BE MANUALLY MODIFIED *
 **************************************************************/
import { MoveEnum, MoveStruct } from '../utils/index.js';
import { bcs } from '@mysten/sui/bcs';
const $moduleName = '@local-pkg/usufruct::curve_shape_policy';
export const CurveShapePolicy = new MoveEnum({ name: `${$moduleName}::CurveShapePolicy`, fields: {
        Linear: null,
        Smoothstep: null,
        PowerLaw: new MoveStruct({ name: `CurveShapePolicy.PowerLaw`, fields: {
                alpha_num: bcs.u8(),
                alpha_den: bcs.u8()
            } }),
        Exponential: new MoveStruct({ name: `CurveShapePolicy.Exponential`, fields: {
                alpha_abs: bcs.u8(),
                alpha_neg: bcs.bool()
            } }),
        Logistic: null
    } });
export const CurveHeight = new MoveStruct({ name: `${$moduleName}::CurveHeight`, fields: {
        h: bcs.u64()
    } });
export const Progress = new MoveEnum({ name: `${$moduleName}::Progress`, fields: {
        Zero: null,
        Complete: null,
        Partial: new MoveStruct({ name: `Progress.Partial`, fields: {
                numerator: bcs.u64(),
                denominator: bcs.u64()
            } })
    } });