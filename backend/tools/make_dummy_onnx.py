#!/usr/bin/env python3
"""Writes a tiny *fake* ONNX classifier (global-average-pool -> linear -> 2 logits) with no dependencies.
Purpose: verify the onnxruntime plumbing (input name, preprocessing, softmax, heatmap) before your real
ResNet/YOLO is ready.   python tools/make_dummy_onnx.py models/model.onnx
Its 'prediction' is just: redder image => class 1 (Abnormal). Not a medical model."""
import struct
import sys


def varint(n):
    n &= (1 << 64) - 1
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        out.append(b | (0x80 if n else 0))
        if not n:
            return bytes(out)


def f_varint(num, v): return varint(num << 3) + varint(v)
def f_bytes(num, b): return varint(num << 3 | 2) + varint(len(b)) + b
def f_str(num, s): return f_bytes(num, s.encode())


def tensor_type(shape):                       # TypeProto{ tensor_type{ elem_type=FLOAT, shape } }
    dims = b"".join(f_bytes(1, f_varint(1, d)) for d in shape)
    return f_bytes(1, f_varint(1, 1) + f_bytes(2, dims))


def value_info(name, shape): return f_str(1, name) + f_bytes(2, tensor_type(shape))


def node(op, ins, outs, attrs=b""):
    return b"".join(f_str(1, i) for i in ins) + b"".join(f_str(2, o) for o in outs) + f_str(4, op) + attrs


def build():
    w = struct.pack("<6f", -1, 1, 0, 0, 0, 0)   # [3,2]: logit0 = -R, logit1 = +R  (R = mean red, normalised)
    init = f_varint(1, 3) + f_varint(1, 2) + f_varint(2, 1) + f_str(8, "W") + f_bytes(9, w)
    flatten_attr = f_str(1, "axis") + f_varint(3, 1) + f_varint(20, 2)
    graph = (
        f_bytes(1, node("GlobalAveragePool", ["input"], ["gap"])) +
        f_bytes(1, node("Flatten", ["gap"], ["flat"], f_bytes(5, flatten_attr))) +
        f_bytes(1, node("MatMul", ["flat", "W"], ["logits"])) +
        f_str(2, "dummy") + f_bytes(5, init) +
        f_bytes(11, value_info("input", [1, 3, 224, 224])) + f_bytes(12, value_info("logits", [1, 2])))
    return f_varint(1, 8) + f_str(2, "oceda-dummy") + f_bytes(7, graph) + f_bytes(8, f_str(1, "") + f_varint(2, 13))


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "models/model.onnx"
    open(out, "wb").write(build())
    print("wrote", out)
