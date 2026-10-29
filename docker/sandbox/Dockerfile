# The sandbox image for the data-analysis agent (003 C6, CL-20): Python with the libraries the
# generated code may use, and nothing that lets it reach out. The container runs with no network,
# so nothing can be installed at run time; everything is installed here, at build time.
#
# Build with `mise run sandbox:build` (image name agentic-ai-sandbox:local).
#
# The base image is pinned by digest (python:3.13-slim, Python 3.13.16, built 2026-10-06).
FROM python:3.13-slim@sha256:70729b46c69b4f1e97c4822c1af3df53a1476cf5ddc6c087c0c10bc3a5678c2f

# MPLBACKEND=Agg: matplotlib renders to files and memory, never to a display.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    MPLBACKEND=Agg \
    MPLCONFIGDIR=/tmp/matplotlib

# A Japanese font, so charts with Japanese labels do not draw empty boxes.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends fonts-ipafont-gothic \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /tmp/requirements.txt
RUN pip install --requirement /tmp/requirements.txt && rm /tmp/requirements.txt

# A numeric non-root user (the provider runs the container as 10001:10001). /work is root-owned and
# read-only for it: the provider places the inputs there, and the code writes only to /tmp.
RUN groupadd --gid 10001 sandbox \
    && useradd --uid 10001 --gid 10001 --no-create-home --home-dir /tmp --shell /usr/sbin/nologin sandbox \
    && mkdir /work

USER 10001:10001
WORKDIR /work
CMD ["python"]
