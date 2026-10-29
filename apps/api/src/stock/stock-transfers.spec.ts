import { StockTransferType, WarehouseType } from '@erp/shared';
import { transferTypeOf } from './stock-transfers.service';

describe('transferTypeOf', () => {
  it('names a load, an unload and any other move', () => {
    const { MAIN, SECONDARY, VEHICLE } = WarehouseType;
    expect(transferTypeOf(MAIN, VEHICLE)).toBe(StockTransferType.LOAD);
    expect(transferTypeOf(SECONDARY, VEHICLE)).toBe(StockTransferType.LOAD);
    expect(transferTypeOf(VEHICLE, MAIN)).toBe(StockTransferType.UNLOAD);
    expect(transferTypeOf(MAIN, SECONDARY)).toBe(StockTransferType.TRANSFER);
    expect(transferTypeOf(VEHICLE, VEHICLE)).toBe(StockTransferType.TRANSFER);
  });
});
