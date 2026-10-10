"""Tiny in-memory pub/sub so the web app gets new captures instantly (via Server-Sent Events).
Single-process only - fine for a prototype. Swap for Redis pub/sub if you ever run >1 worker."""
import asyncio
from collections import defaultdict


class Bus:
    def __init__(self):
        self._subs = defaultdict(set)

    def subscribe(self, exam_id: str) -> asyncio.Queue:
        q = asyncio.Queue(maxsize=100)
        self._subs[exam_id].add(q)
        return q

    def unsubscribe(self, exam_id: str, q: asyncio.Queue):
        self._subs[exam_id].discard(q)
        if not self._subs[exam_id]:
            del self._subs[exam_id]

    def publish(self, exam_id: str, event: str, data: dict):
        for q in list(self._subs.get(exam_id, ())):
            try:
                q.put_nowait((event, data))
            except asyncio.QueueFull:
                pass  # slow consumer; it can re-sync with GET /api/exams/{id}


bus = Bus()
