# Lambda container image for FastAPI + OpenPyXL. TODO(BE): add handler.
FROM public.ecr.aws/lambda/python:3.12
COPY pyproject.toml ./
RUN pip install --no-cache-dir .
COPY app ./app
CMD ["app.main.handler"]
