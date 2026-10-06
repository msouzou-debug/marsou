import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  BacklogItem,
  BacklogSummaryRow,
  MaintenanceContract,
  MaintenanceSummary,
  PmGenerationResult,
  PmSchedule,
  Scorecard,
  SlaImportResult,
  SlaSystem,
  WorkOrder,
  WorkOrderDetail,
  WorkOrderListRow,
} from "@ecapital/shared";
import {
  buildBacklogList,
  buildBacklogSummary,
  buildMaintenanceContract,
  buildMaintenanceSummary,
  buildPmGenerationResult,
  buildPmSchedule,
  buildPmWorkOrder,
  buildScorecard,
  buildSlaImportResult,
  buildSlaSystems,
  buildWorkOrder,
  buildWorkOrderDetail,
  buildWorkOrderList,
} from "./maintenance";

// The fixtures stand in for the API in tests and the gallery, so they must be
// exactly what the contract accepts — otherwise a screen is tested on a shape
// it will never receive.
describe("maintenance fixtures parse with the shared schemas", () => {
  it("summary, agreement, catalogue, import result", () => {
    expect(() => MaintenanceSummary.parse(buildMaintenanceSummary())).not.toThrow();
    expect(() => MaintenanceContract.parse(buildMaintenanceContract())).not.toThrow();
    expect(() => z.array(SlaSystem).parse(buildSlaSystems())).not.toThrow();
    expect(() => SlaImportResult.parse(buildSlaImportResult())).not.toThrow();
  });

  it("programme and generator result", () => {
    expect(() => PmSchedule.parse(buildPmSchedule())).not.toThrow();
    expect(() => PmGenerationResult.parse(buildPmGenerationResult())).not.toThrow();
  });

  it("work orders: one, the list, the detail", () => {
    expect(() => WorkOrder.parse(buildWorkOrder())).not.toThrow();
    expect(() => WorkOrder.parse(buildPmWorkOrder())).not.toThrow();
    expect(() => z.array(WorkOrderListRow).parse(buildWorkOrderList().items)).not.toThrow();
    expect(() => WorkOrderDetail.parse(buildWorkOrderDetail())).not.toThrow();
  });

  it("backlog and scorecard", () => {
    expect(() => z.array(BacklogItem).parse(buildBacklogList().items)).not.toThrow();
    expect(() => z.array(BacklogSummaryRow).parse(buildBacklogSummary())).not.toThrow();
    expect(() => Scorecard.parse(buildScorecard())).not.toThrow();
  });
});
