-- Raise season-winners Storage upload limit to 20 MB.
update storage.buckets
set file_size_limit = 20971520
where id = 'season-winners';
