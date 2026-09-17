from ._common import *


BATCH_LOOP_CLASS = "ComfyTV.BatchLoop"


class BatchLoop(io.ComfyNode):
    """Marker node for ComfyTV stage workflows.

    When this node is present in a linked workflow, the Stage runner treats
    ``option:batch_size`` as a *repeat count*: it executes the graph N times
    (reseeding each pass) and merges image outputs into one batch.

    Bind Stage ``option:batch_size`` to this node's ``batch_size`` input.
    Do not also bind ``batch_size`` to EmptyLatent / sampler batch widgets, or
    you will multiply native batching by the loop count.
    """

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=BATCH_LOOP_CLASS,
            display_name="Batch Loop (ComfyTV)",
            category="ComfyTV/Utils",
            inputs=[
                io.Int.Input(
                    "batch_size",
                    default=1,
                    min=1,
                    max=8,
                    step=1,
                    display_mode=io.NumberDisplay.slider,
                    tooltip=(
                        "Bind Stage option:batch_size here. ComfyTV runs the "
                        "workflow this many times and merges SaveImage outputs."
                    ),
                ),
            ],
            outputs=[io.Int.Output("batch_size")],
        )

    @classmethod
    def execute(cls, batch_size=1):
        return io.NodeOutput(max(1, min(8, int(batch_size or 1))))
