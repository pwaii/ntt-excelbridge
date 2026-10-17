# Optional Lambda container image for the API surface. The SAM deployment uses
# the zip-based functions in infra/template.yaml; this image remains useful for
# local/container-oriented deployment.
FROM public.ecr.aws/lambda/python:3.12
COPY pyproject.toml ./
RUN pip install --no-cache-dir .
COPY app ./app
CMD ["app.lambda_handlers.api_handler"]
