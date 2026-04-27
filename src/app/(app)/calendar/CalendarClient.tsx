"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MonthCalendar, type DayIndicators } from "@/components/MonthCalendar";
import { DayDetailSheet } from "@/components/DayDetailSheet";

export function CalendarClient({
  todayYmd,
  indicators,
}: {
  todayYmd: string;
  indicators?: Record<string, DayIndicators>;
}) {
  const router = useRouter();
  const [selectedYmd, setSelectedYmd] = useState<string>(todayYmd);
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <>
      <MonthCalendar
        selectedYmd={selectedYmd}
        todayYmd={todayYmd}
        indicators={indicators}
        onSelect={(ymd) => {
          setSelectedYmd(ymd);
          setSheetOpen(true);
        }}
      />

      <DayDetailSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        ymd={selectedYmd}
        onChanged={() => router.refresh()}
      />
    </>
  );
}
