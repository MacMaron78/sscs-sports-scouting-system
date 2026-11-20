from django.db import migrations, models
from django.utils import timezone


def ensure_created_at_column(apps, schema_editor):
    shortlist_model = apps.get_model("core", "Shortlist")
    table_name = shortlist_model._meta.db_table
    connection = schema_editor.connection

    with connection.cursor() as cursor:
        columns = {
            column.name
            for column in connection.introspection.get_table_description(cursor, table_name)
        }

    if "created_at" not in columns:
        field = models.DateTimeField(default=timezone.now, editable=False)
        field.set_attributes_from_name("created_at")
        field.model = shortlist_model
        schema_editor.add_field(shortlist_model, field)


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0005_add_message_is_read"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunPython(
                    ensure_created_at_column,
                    migrations.RunPython.noop,
                ),
            ],
            state_operations=[
                migrations.AddField(
                    model_name="shortlist",
                    name="created_at",
                    field=models.DateTimeField(
                        default=timezone.now,
                        editable=False,
                    ),
                ),
            ],
        ),
    ]
