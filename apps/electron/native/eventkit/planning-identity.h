#pragma once
#import <Foundation/Foundation.h>

// 新建 marker 只使用 Carpus；旧 scheme 仅作为本软件已有系统事项的迁移入口。
static NSURL *CarpusPlanningIdentityURL(NSString *entity, NSString *identity) {
  if (!identity || ![[NSUUID alloc] initWithUUIDString:identity]) return nil;
  return [NSURL URLWithString:[NSString stringWithFormat:@"carpus://planning/%@/%@", entity, identity]];
}

// 只识别严格 UUID marker，用户的任意 URL 不得通过 DTO 透出到 JS。
static NSString *CarpusPlanningIdentity(NSString *entity, NSURL *url) {
  NSString *absolute = url.absoluteString;
  for (NSString *scheme in @[@"carpus", @"proma"]) {
    NSString *prefix = [NSString stringWithFormat:@"%@://planning/%@/", scheme, entity];
    if (![absolute hasPrefix:prefix]) continue;
    NSString *identity = [absolute substringFromIndex:prefix.length];
    return [[NSUUID alloc] initWithUUIDString:identity] ? identity : nil;
  }
  return nil;
}

static BOOL CarpusPlanningIdentityMatches(NSString *entity, NSString *identity, NSURL *url) {
  NSString *existingIdentity = CarpusPlanningIdentity(entity, url);
  return existingIdentity && identity && [[[NSUUID alloc] initWithUUIDString:existingIdentity] isEqual:[[NSUUID alloc] initWithUUIDString:identity]];
}

// 用户 URL 保持原样；只有本软件的旧 marker 在下一次已授权同步写入时升级为 Carpus。
static NSURL *CarpusPlanningUpsertIdentityURL(NSString *entity, NSString *identity, NSURL *existingURL) {
  NSString *existingIdentity = CarpusPlanningIdentity(entity, existingURL);
  if (existingURL && !existingIdentity) return existingURL;
  return CarpusPlanningIdentityURL(entity, identity ?: existingIdentity) ?: existingURL;
}
