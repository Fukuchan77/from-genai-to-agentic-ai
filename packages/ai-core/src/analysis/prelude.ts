import { DEFAULT_ANALYSIS } from "../config/defaults";
import { PNG_MARKER, TABLE_MARKER } from "./output-parser";

/** The module the run imports its helpers from; the sandbox holds it as `sandbox_helpers.py`. */
export const ANALYSIS_HELPERS_MODULE = "sandbox_helpers";
export const ANALYSIS_HELPERS_FILE = `${ANALYSIS_HELPERS_MODULE}.py`;

/** The one line put in front of the generated code so `show_figure` and `show_table` exist. */
export function helpersImportLine(): string {
	return `from ${ANALYSIS_HELPERS_MODULE} import show_figure, show_table`;
}

/**
 * The Python the sandbox holds as `sandbox_helpers.py` (003 CL-19). `show_figure(alt)` and
 * `show_table(df, caption)` print one marker line each; `output-parser.ts` takes those lines out of
 * stdout on the host. Both providers use this one path, instead of the E2B-only chart results. It
 * imports nothing but base64, io, json, math and matplotlib.
 */
export const analysisPrelude = `import base64
import io
import json
import math

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager

# A Japanese-capable font when the image has one (the Docker image installs IPAGothic).
_installed_fonts = {font.name for font in font_manager.fontManager.ttflist}
plt.rcParams["font.family"] = [
    name for name in ("IPAGothic", "Noto Sans CJK JP") if name in _installed_fonts
] + ["DejaVu Sans"]
plt.rcParams["axes.unicode_minus"] = False

_MAX_TABLE_ROWS = ${DEFAULT_ANALYSIS.maxTableRows}


def show_figure(alt, fig=None):
    """Show the current matplotlib figure (or fig) to the learner. alt describes it in words."""
    figure = fig if fig is not None else plt.gcf()
    buffer = io.BytesIO()
    figure.savefig(buffer, format="png", dpi=100, bbox_inches="tight")
    plt.close(figure)
    payload = {"alt": str(alt), "base64": base64.b64encode(buffer.getvalue()).decode("ascii")}
    print("${PNG_MARKER}" + json.dumps(payload, ensure_ascii=False), flush=True)


def _cell(value):
    if value is None:
        return None
    if hasattr(value, "item"):
        try:
            value = value.item()
        except (ValueError, TypeError):
            pass
    try:
        if value != value:  # NaN, NaT
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(value, bool):
        return str(value)
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, (int, str)):
        return value
    return str(value)


def show_table(df, caption):
    """Show a pandas DataFrame to the learner as a table (the first ${DEFAULT_ANALYSIS.maxTableRows} rows)."""
    if hasattr(df, "to_frame") and not hasattr(df, "columns"):
        df = df.to_frame()
    head = df.head(_MAX_TABLE_ROWS)
    payload = {
        "caption": str(caption),
        "columns": [str(column) for column in head.columns],
        "rows": [[_cell(value) for value in row] for row in head.itertuples(index=False, name=None)],
        "totalRows": int(len(df)),
    }
    print("${TABLE_MARKER}" + json.dumps(payload, ensure_ascii=False, allow_nan=False), flush=True)
`;
