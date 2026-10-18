# A sample of the code the analysis agent writes (003 CL-19): read the uploaded file, draw one
# chart and print one table, each as a single marker line the host extracts from stdout.
# The container test runs it against `data.csv` (columns: month, sales) inside the sandbox image.
import base64
import io
import json

import matplotlib.pyplot as plt
import pandas as pd

plt.rcParams["font.family"] = ["IPAGothic", "DejaVu Sans"]

df = pd.read_csv("data.csv")
monthly = df.groupby("month", as_index=False)["sales"].sum()

fig, ax = plt.subplots(figsize=(4, 3))
ax.bar(monthly["month"], monthly["sales"])
ax.set_title("月別売上")
buffer = io.BytesIO()
fig.savefig(buffer, format="png", dpi=80)

figure = {
    "alt": "月別売上の棒グラフ",
    "base64": base64.b64encode(buffer.getvalue()).decode("ascii"),
}
table = {
    "caption": "月別売上",
    "columns": [str(column) for column in monthly.columns],
    "rows": monthly.values.tolist(),
    "totalRows": len(monthly),
}
print("__PNG__:" + json.dumps(figure, ensure_ascii=False))
print("__TABLE__:" + json.dumps(table, ensure_ascii=False))
print("rows:", len(df))
