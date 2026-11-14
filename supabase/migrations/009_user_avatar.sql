-- Profile picture, stored inline as a small image data URL (the browser crops it to 256x256 JPEG).
-- Only JPEG, PNG and WebP are accepted, so no SVG or script can be stored as a picture.
-- Safe to run more than once.
alter table public.users add column if not exists avatar text;

alter table public.users drop constraint if exists users_avatar_check;
alter table public.users add constraint users_avatar_check check (
  avatar is null
  or (char_length(avatar) <= 300000 and avatar ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$')
);
