// Shared fixture data between AreaPicker.preview.tsx (the entry, plain data)
// and AreaPicker.preview.demo.tsx (the interactive "use client" demo).
export const TREE = {
  orgUnitId: "unit-1",
  buildings: [
    {
      id: "b1",
      orgUnitId: "unit-1",
      code: "A",
      nameEl: "Κτίριο Α",
      grossAreaM2: null,
      yearBuilt: null,
      storeys: null,
      floors: [
        {
          id: "f1",
          buildingId: "b1",
          code: "1",
          nameEl: "1ος όροφος",
          level: 1,
          areas: [
            { id: "a1", floorId: "f1", code: "A101", nameEl: "Χειρουργείο 1", areaType: "THEATRE" as const, patientRiskGroup: "HIGH" as const, costCentre: null, beds: null },
            { id: "a2", floorId: "f1", code: "A102", nameEl: "Χειρουργείο 2", areaType: "THEATRE" as const, patientRiskGroup: "HIGH" as const, costCentre: null, beds: null },
          ],
        },
      ],
    },
  ],
};

export const INDIRECT = [
  {
    areaId: "a3",
    code: "A201",
    nameEl: "ΜΕΘ",
    areaType: "ICU" as const,
    patientRiskGroup: "HIGHEST" as const,
    buildingCode: "A",
    floorCode: "2",
    impact: "INDIRECT" as const,
    viaSystem: "ELECTRICAL" as const,
  },
];
