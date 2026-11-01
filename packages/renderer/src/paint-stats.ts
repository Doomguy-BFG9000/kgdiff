/** Counters filled by each paint (tests, the dev harness readout). */
export interface PaintStats {
  nodes: number;
  edges: number;
  culledNodes: number;
  culledEdges: number;
  labels: number;
  /** `stroke()` calls issued for edges (one per non-empty style bucket). */
  edgeStrokes: number;
  /** Labels placed but not yet rasterized (budget); the renderer schedules another frame. */
  deferredLabels: number;
  /** Passes in draw order, per layer. */
  readonly phases: string[];
}

export function createStats(): PaintStats {
  return {
    nodes: 0,
    edges: 0,
    culledNodes: 0,
    culledEdges: 0,
    labels: 0,
    edgeStrokes: 0,
    deferredLabels: 0,
    phases: [],
  };
}

export function resetStats(s: PaintStats): void {
  s.nodes = 0;
  s.edges = 0;
  s.culledNodes = 0;
  s.culledEdges = 0;
  s.labels = 0;
  s.edgeStrokes = 0;
  s.deferredLabels = 0;
  s.phases.length = 0;
}
