import { describe, expect, it, vi } from "vitest";
import type { TallyGridDocument } from "../src/grid-adapter";
import {
  tallyColumnName,tallyCellAddress,windowToA1Range,
  readTallyWindow,commitTallyGridCell
} from "../src/grid-adapter";

describe("Tally viewport adapter for NYC-Tron native SpreadsheetGrid",()=>{
  it("converts window rows and columns into A1 addresses",()=>{
    expect(tallyColumnName(0)).toBe("A");
    expect(tallyColumnName(25)).toBe("Z");
    expect(tallyColumnName(26)).toBe("AA");
    expect(tallyColumnName(16383)).toBe("XFD");
    expect(tallyCellAddress(99,26)).toBe("AA100");
    expect(windowToA1Range({startRow:9,endRow:12,startColumn:1,endColumn:4}))
      .toEqual({from:"B10",to:"D12"});
    expect(windowToA1Range({startRow:0,endRow:0,startColumn:0,endColumn:0}))
      .toBeNull();
  });

  it("rejects impossible or oversized reads",()=>{
    expect(()=>windowToA1Range({startRow:-1,endRow:3,startColumn:0,endColumn:9})).toThrow();
    expect(()=>windowToA1Range({startRow:0,endRow:99,startColumn:0,endColumn:99})).toThrow();
    expect(()=>tallyCellAddress(0,16384)).toThrow();
  });

  it("reads only the viewport and maps Rust returned cells by address",async()=>{
    const getRange=vi.fn().mockResolvedValue({events:[],data:{cells:[[
      {addr:"B10",raw:"=2+2",computed:4},
      {addr:"C10",raw:"hello",computed:"hello"}
    ]]}});
    const setCell=vi.fn().mockResolvedValue({events:[],data:{}});
    const doc={getRange,setCell} as unknown as TallyGridDocument;
    const out=await readTallyWindow(doc,{startRow:9,endRow:10,startColumn:1,endColumn:3});
    expect(getRange).toHaveBeenCalledWith("B10","C10");
    expect(out["B10"].computed).toBe(4);
    expect(out["C10"].raw).toBe("hello");
    expect(Object.keys(out)).toHaveLength(2);
  });

  it("waits for the Rust commit and never fabricates a success",async()=>{
    const getRange=vi.fn();
    const setCell=vi.fn().mockResolvedValue({
      events:[{kind:"document:changed"}],data:{addr:"A1",computed:8}
    });
    const doc={getRange,setCell} as unknown as TallyGridDocument;
    const result=await commitTallyGridCell(doc,"A1","=4+4");
    expect(setCell).toHaveBeenCalledWith("A1","=4+4");
    expect(result.data.computed).toBe(8);
    await expect(commitTallyGridCell(doc,"A0","42")).rejects.toThrow();
  });
});
