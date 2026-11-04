#define NAPI_VERSION 8
#include <node_api.h>
#include <errno.h>
#include <fcntl.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#ifndef _WIN32
#include <dirent.h>
#include <stdint.h>
#include <stdlib.h>

#ifndef O_CLOEXEC
#define O_CLOEXEC 0
#endif
#ifndef O_DIRECTORY
#define O_DIRECTORY 0
#endif
#ifndef O_NOFOLLOW
#define O_NOFOLLOW 0
#endif

#define MAX_PATH 4096
#define MAX_NAME 255
#define MAX_LIST 65536

static int invalid_name(const char *name) {
  size_t n;
  const unsigned char *p;
  if (name == NULL) return 1;
  n = strlen(name);
  if (n == 0 || n > MAX_NAME) return 1;
  if (strcmp(name, ".") == 0 || strcmp(name, "..") == 0) return 1;
  if (strchr(name, '/') != NULL || strchr(name, '\\') != NULL || strchr(name, ':') != NULL) return 1;
  for (p = (const unsigned char *)name; *p != 0; p++) {
    if (*p < 32 || *p == 127) return 1;
  }
  return 0;
}

static napi_value fd_result(napi_env env, int fd) {
  napi_value obj, fdv, errv;
  napi_create_object(env, &obj);
  napi_create_int32(env, fd, &fdv);
  napi_create_int32(env, fd < 0 ? errno : 0, &errv);
  napi_set_named_property(env, obj, "fd", fdv);
  napi_set_named_property(env, obj, "errno", errv);
  return obj;
}

static int read_fd_arg(napi_env env, napi_value value, int32_t *fd) {
  return napi_get_value_int32(env, value, fd) == napi_ok ? 0 : -1;
}

static napi_value OpenRoot(napi_env env, napi_callback_info info) {
  size_t argc = 1, len = 0;
  napi_value args[1];
  char path[MAX_PATH];
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);
  if (argc < 1 || napi_get_value_string_utf8(env, args[0], path, sizeof(path), &len) != napi_ok || len == 0 || len >= sizeof(path) - 1) {
    errno = EINVAL;
    return fd_result(env, -1);
  }
  if (path[0] != '/') {
    errno = EINVAL;
    return fd_result(env, -1);
  }
  return fd_result(env, open(path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC));
}

static napi_value OpenAt(napi_env env, napi_callback_info info) {
  size_t argc = 3, len = 0;
  napi_value args[3];
  int32_t dirfd = -1, as_dir = 0;
  char name[MAX_NAME + 1];
  int flags;
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);
  if (argc < 3 || read_fd_arg(env, args[0], &dirfd) != 0 || napi_get_value_string_utf8(env, args[1], name, sizeof(name), &len) != napi_ok || napi_get_value_int32(env, args[2], &as_dir) != napi_ok) {
    errno = EINVAL;
    return fd_result(env, -1);
  }
  if (dirfd < 0 || invalid_name(name)) {
    errno = EINVAL;
    return fd_result(env, -1);
  }
  /* A replaced FIFO or device must not block the type check. */
  flags = O_RDONLY | O_NOFOLLOW | O_CLOEXEC | (as_dir ? 0 : O_NONBLOCK);
  if (as_dir) flags |= O_DIRECTORY;
  return fd_result(env, openat(dirfd, name, flags));
}

static napi_value FstatFd(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1], obj, ok, dev, ino, mode, size, nlink;
  int32_t fd = -1;
  struct stat st;
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);
  napi_create_object(env, &obj);
  if (argc < 1 || read_fd_arg(env, args[0], &fd) != 0 || fd < 0 || fstat(fd, &st) != 0) {
    napi_get_boolean(env, 0, &ok);
    napi_create_int32(env, errno == 0 ? EINVAL : errno, &mode);
    napi_set_named_property(env, obj, "ok", ok);
    napi_set_named_property(env, obj, "errno", mode);
    return obj;
  }
  napi_get_boolean(env, 1, &ok);
  napi_create_bigint_uint64(env, (uint64_t)st.st_dev, &dev);
  napi_create_bigint_uint64(env, (uint64_t)st.st_ino, &ino);
  napi_create_uint32(env, (uint32_t)st.st_mode, &mode);
  napi_create_bigint_uint64(env, (uint64_t)st.st_size, &size);
  napi_create_bigint_uint64(env, (uint64_t)st.st_nlink, &nlink);
  napi_set_named_property(env, obj, "ok", ok);
  napi_set_named_property(env, obj, "dev", dev);
  napi_set_named_property(env, obj, "ino", ino);
  napi_set_named_property(env, obj, "mode", mode);
  napi_set_named_property(env, obj, "size", size);
  napi_set_named_property(env, obj, "nlink", nlink);
  return obj;
}

static napi_value list_error(napi_env env, int err) {
  napi_value obj, ok, names, errv;
  napi_create_object(env, &obj);
  napi_get_boolean(env, 0, &ok);
  napi_create_array(env, &names);
  napi_create_int32(env, err, &errv);
  napi_set_named_property(env, obj, "ok", ok);
  napi_set_named_property(env, obj, "names", names);
  napi_set_named_property(env, obj, "errno", errv);
  return obj;
}

static napi_value ListDir(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1], obj, ok, names;
  int32_t dirfd = -1;
  int dupfd;
  DIR *dir;
  struct dirent *ent;
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);
  if (argc < 1 || read_fd_arg(env, args[0], &dirfd) != 0 || dirfd < 0) return list_error(env, EINVAL);
  dupfd = openat(dirfd, ".", O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  if (dupfd < 0) return list_error(env, errno);
  dir = fdopendir(dupfd);
  if (dir == NULL) {
    int saved = errno;
    close(dupfd);
    return list_error(env, saved);
  }
  napi_create_object(env, &obj);
  napi_get_boolean(env, 1, &ok);
  napi_create_array(env, &names);
  errno = 0;
  while ((ent = readdir(dir)) != NULL) {
    napi_value name;
    uint32_t len;
    if (strcmp(ent->d_name, ".") == 0 || strcmp(ent->d_name, "..") == 0) continue;
    if (invalid_name(ent->d_name)) continue;
    napi_get_array_length(env, names, &len);
    if (len >= 64) {
      closedir(dir);
      return list_error(env, ERANGE);
    }
    napi_create_string_utf8(env, ent->d_name, NAPI_AUTO_LENGTH, &name);
    napi_set_element(env, names, len, name);
  }
  if (errno != 0) {
    int saved = errno;
    closedir(dir);
    return list_error(env, saved);
  }
  closedir(dir);
  napi_set_named_property(env, obj, "ok", ok);
  napi_set_named_property(env, obj, "names", names);
  return obj;
}

static napi_value ReadFd(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2], obj, ok, bytes, errv;
  int32_t fd = -1, max_bytes = 0;
  char *buf;
  ssize_t n;
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);
  napi_create_object(env, &obj);
  if (argc < 2 || read_fd_arg(env, args[0], &fd) != 0 || napi_get_value_int32(env, args[1], &max_bytes) != napi_ok || fd < 0 || max_bytes <= 0 || max_bytes > 65536) {
    napi_get_boolean(env, 0, &ok);
    napi_create_int32(env, EINVAL, &errv);
    napi_set_named_property(env, obj, "ok", ok);
    napi_set_named_property(env, obj, "errno", errv);
    return obj;
  }
  buf = (char *)malloc((size_t)max_bytes);
  if (buf == NULL) {
    napi_get_boolean(env, 0, &ok);
    napi_create_int32(env, ENOMEM, &errv);
    napi_set_named_property(env, obj, "ok", ok);
    napi_set_named_property(env, obj, "errno", errv);
    return obj;
  }
  n = read(fd, buf, (size_t)max_bytes);
  if (n < 0) {
    int saved = errno;
    free(buf);
    napi_get_boolean(env, 0, &ok);
    napi_create_int32(env, saved, &errv);
    napi_set_named_property(env, obj, "ok", ok);
    napi_set_named_property(env, obj, "errno", errv);
    return obj;
  }
  napi_get_boolean(env, 1, &ok);
  napi_create_buffer_copy(env, (size_t)n, buf, NULL, &bytes);
  free(buf);
  napi_set_named_property(env, obj, "ok", ok);
  napi_set_named_property(env, obj, "bytes", bytes);
  return obj;
}

static napi_value CloseFd(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1], result;
  int32_t fd = -1;
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);
  if (argc < 1 || read_fd_arg(env, args[0], &fd) != 0 || fd < 0) {
    napi_create_int32(env, -1, &result);
    return result;
  }
  napi_create_int32(env, close(fd), &result);
  return result;
}

#endif

static napi_value Init(napi_env env, napi_value exports) {
  napi_value available;
#ifdef _WIN32
  napi_get_boolean(env, 0, &available);
  napi_set_named_property(env, exports, "available", available);
#else
  napi_property_descriptor desc[] = {
    { "openRoot", NULL, OpenRoot, NULL, NULL, NULL, napi_default, NULL },
    { "openAt", NULL, OpenAt, NULL, NULL, NULL, napi_default, NULL },
    { "fstat", NULL, FstatFd, NULL, NULL, NULL, napi_default, NULL },
    { "list", NULL, ListDir, NULL, NULL, NULL, napi_default, NULL },
    { "read", NULL, ReadFd, NULL, NULL, NULL, napi_default, NULL },
    { "close", NULL, CloseFd, NULL, NULL, NULL, napi_default, NULL },
  };
  napi_get_boolean(env, 1, &available);
  napi_set_named_property(env, exports, "available", available);
  napi_define_properties(env, exports, sizeof(desc) / sizeof(desc[0]), desc);
#endif
  return exports;
}

NAPI_MODULE(hearth_posix_dir, Init)
