import { describe, expect, it } from "vitest";
import { backlogApiPath, pmSchedulesApiPath, scorecardQueryString, workOrdersApiPath } from "./queries";

// M5 routes (ADR-0031): the paths the hooks send through the proxy.
describe("maintenance API paths", () => {
  it("repeats `status` for a multi-status work order filter and defaults to newest call first", () => {
    const path = workOrdersApiPath({ orgUnitId: "u1", status: ["OPEN", "PAUSED"], band: "CRITICAL", slaState: "RED", q: " lift " });
    const url = new URL(path, "http://x");
    expect(url.pathname).toBe("/work-orders");
    expect(url.searchParams.getAll("status")).toEqual(["OPEN", "PAUSED"]);
    expect(url.searchParams.get("band")).toBe("CRITICAL");
    expect(url.searchParams.get("slaState")).toBe("RED");
    expect(url.searchParams.get("q")).toBe("lift");
    expect(url.searchParams.get("sort")).toBe("calledAt");
    expect(url.searchParams.get("dir")).toBe("desc");
    expect(url.searchParams.get("pageSize")).toBe("100");
  });

  it("never asks for more than the API's 100 rows", () => {
    expect(new URL(workOrdersApiPath({ pageSize: 500 } as never), "http://x").searchParams.get("pageSize")).toBe("100");
  });

  it("builds the backlog, schedules and scorecard queries", () => {
    const backlog = new URL(backlogApiPath({ status: ["OPEN", "FUNDED"], autoDrafted: true }), "http://x");
    expect(backlog.searchParams.getAll("status")).toEqual(["OPEN", "FUNDED"]);
    expect(backlog.searchParams.get("autoDrafted")).toBe("true");
    expect(pmSchedulesApiPath({})).toBe("/maintenance/schedules");
    expect(pmSchedulesApiPath({ maintenanceContractId: "mc-1", active: true })).toBe("/maintenance/schedules?maintenanceContractId=mc-1&active=true");
    expect(scorecardQueryString({ maintenanceContractId: "mc-1", from: "2026-07-01", to: "2026-10-01" })).toBe(
      "maintenanceContractId=mc-1&from=2026-07-01&to=2026-10-01",
    );
  });
});
